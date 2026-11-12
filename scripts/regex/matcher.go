// Build with build.sh. The host provides bounded byte ranges and collects hits.
package main

import (
	"bytes"
	"errors"
	"io"
	"os"
	"regexp"
	"syscall/js"
	"unicode/utf8"
)

const chunkSize = 64 * 1024
const previewSize = 512

type chunk struct {
	start int
	data  []byte
}

type source struct {
	host  js.Value
	size  int
	last  int
	cache [2]chunk
}

func (s *source) at(position int) ([]byte, error) {
	start := position / chunkSize * chunkSize
	for i, c := range s.cache {
		if c.data != nil && c.start == start {
			s.last = i
			return c.data[position-start:], nil
		}
	}
	end := min(start+chunkSize, s.size)
	data, err := await(s.host.Call("read", start, end))
	if err != nil {
		return nil, err
	}
	s.last = 1 - s.last
	c := &s.cache[s.last]
	if cap(c.data) < end-start {
		c.data = make([]byte, end-start)
	}
	c.data = c.data[:end-start]
	if js.CopyBytesToGo(c.data, data) != end-start {
		return nil, errors.New("invalid regex input range")
	}
	c.start = start
	return c.data[position-start:], nil
}

func await(promise js.Value) (js.Value, error) {
	result := make(chan js.Value, 1)
	ok := js.FuncOf(func(_ js.Value, args []js.Value) any {
		result <- args[0]
		return nil
	})
	fail := js.FuncOf(func(_ js.Value, _ []js.Value) any {
		result <- js.Undefined()
		return nil
	})
	defer ok.Release()
	defer fail.Release()
	promise.Call("then", ok, fail)
	data := <-result
	if data.IsUndefined() {
		return data, errors.New("regex input request failed")
	}
	return data, nil
}

func (s *source) byteAt(position int) (byte, error) {
	data, err := s.at(position)
	if err != nil {
		return 0, err
	}
	return data[0], nil
}

// line holds byte boundaries, so even a single enormous line uses fixed buffers.
type line struct {
	start, end, next int
}

func (s *source) lineAt(position int, backward bool) (line, error) {
	var start, end, next int
	var err error
	if backward {
		end = position
		var last byte
		if last, err = s.byteAt(end - 1); err != nil {
			return line{}, err
		}
		if last == '\n' {
			end--
		}
		start, err = s.lineStart(end)
		next = start
	} else {
		start = position
		end, err = s.lineEnd(start)
		next = end
		if end < s.size {
			next++
		}
	}
	if err != nil {
		return line{}, err
	}
	terminated := end < s.size
	if terminated && end > start {
		last, err := s.byteAt(end - 1)
		if err != nil {
			return line{}, err
		}
		if last == '\r' {
			end--
		}
	}
	if start == 0 && end >= 3 {
		data, err := s.at(0)
		if err != nil {
			return line{}, err
		}
		if bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
			start = 3
		}
	}
	return line{start, end, next}, nil
}

func (s *source) lineEnd(start int) (int, error) {
	for position := start; position < s.size; {
		data, err := s.at(position)
		if err != nil {
			return 0, err
		}
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			return position + i, nil
		}
		position += len(data)
	}
	return s.size, nil
}

func (s *source) lineStart(end int) (int, error) {
	for position := end; position > 0; {
		start := (position - 1) / chunkSize * chunkSize
		data, err := s.at(start)
		if err != nil {
			return 0, err
		}
		if i := bytes.LastIndexByte(data[:position-start], '\n'); i >= 0 {
			return start + i + 1, nil
		}
		position = start
	}
	return 0, nil
}

type lineReader struct {
	source        *source
	position, end int
	window        []byte
	err           error
}

func (r *lineReader) ReadRune() (rune, int, error) {
	if r.err != nil {
		return 0, 0, r.err
	}
	if r.position >= r.end {
		return 0, 0, io.EOF
	}
	if len(r.window) == 0 {
		data, err := r.source.at(r.position)
		if err != nil {
			return r.fail(err)
		}
		r.window = data[:min(len(data), r.end-r.position)]
	}

	if !utf8.FullRune(r.window) && len(r.window) < r.end-r.position {
		return r.readSeam()
	}
	value, width := utf8.DecodeRune(r.window)
	return r.consume(value, width, r.window[width:])
}

func (r *lineReader) readSeam() (rune, int, error) {
	var seam [utf8.UTFMax]byte
	before := copy(seam[:], r.window)
	data, err := r.source.at(r.position + before)
	if err != nil {
		return r.fail(err)
	}
	following := data[:min(len(data), r.end-r.position-before)]
	n := before + copy(seam[before:], following)
	value, width := utf8.DecodeRune(seam[:n])
	if value == utf8.RuneError && width == 1 {
		return r.fail(errors.New("Regex input is not valid UTF-8 text"))
	}
	return r.consume(value, width, following[width-before:])
}

func (r *lineReader) consume(value rune, width int, rest []byte) (rune, int, error) {
	if value == utf8.RuneError && width == 1 {
		return r.fail(errors.New("Regex input is not valid UTF-8 text"))
	}
	r.window = rest
	r.position += width
	return value, width, nil
}

func (r *lineReader) fail(err error) (rune, int, error) {
	r.err = err
	return 0, 0, err
}

func find(s *source, re *regexp.Regexp, current line) ([]int, error) {
	reader := lineReader{source: s, position: current.start, end: current.end}
	match := re.FindReaderIndex(&reader)
	// The regex can stop early. Validate the rest of the visited line as well.
	for reader.position < reader.end && reader.err == nil {
		_, _, _ = reader.ReadRune()
	}
	return match, reader.err
}

func (s *source) preview(current line, hit int) (int, js.Value, error) {
	start := max(current.start, min(hit-previewSize/4, current.end-previewSize))
	end := min(current.end, start+previewSize+1)
	var buffer [previewSize + 1]byte
	for position := start; position < end; {
		chunk, err := s.at(position)
		if err != nil {
			return 0, js.Undefined(), err
		}
		position += copy(buffer[position-start:end-start], chunk)
	}
	output := js.Global().Get("Uint8Array").New(end - start)
	js.CopyBytesToJS(output, buffer[:end-start])
	return start, output, nil
}

func scan(host js.Value) error {
	re, err := regexp.Compile(host.Get("pattern").String())
	if err != nil {
		return errors.New("Invalid or unsupported search regex")
	}
	s := source{host: host, size: host.Get("size").Int()}
	position := host.Get("position").Int()
	number := host.Get("line").Int()
	backward := host.Get("backward").Bool()
	for (backward && position > 0) || (!backward && position < s.size) {
		current, err := s.lineAt(position, backward)
		if err != nil {
			return err
		}
		match, err := find(&s, re, current)
		if err != nil {
			return err
		}
		currentNumber := number
		position = current.next
		number++
		if match != nil {
			offset := current.start + match[0]
			base, preview, err := s.preview(current, offset)
			if err != nil {
				return err
			}
			if !host.Call("hit", currentNumber, offset, current.start, current.end, base, preview).Bool() {
				break
			}
		}
	}
	host.Call("finish", position, number)
	return nil
}

func main() {
	host := js.Global().Get(os.Args[1])
	if err := scan(host); err != nil {
		host.Call("fail", err.Error())
	}
}
