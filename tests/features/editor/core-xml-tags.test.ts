import { isEmptyXmlTagPair, xmlTagToClose } from '@sb/core/xml-tags'
import { describe, expect, test } from 'bun:test'

describe('XML tag recognition', () => {
  test.each([
    ['<div>', 'div'],
    ['before <custom-tag>', 'custom-tag'],
    ['<system-reminder>', 'system-reminder'],
    ['<ns:Custom.Tag_1>', 'ns:Custom.Tag_1'],
    ['<div title="a < b > c">', 'div'],
    ["<div title='a < b > c' disabled>", 'div'],
    ['<div\n  id="test">', 'div'],
    ['<div data-url=https://example.com>', 'div'],
    ['<div>one</div><div>', 'div'],
    ['<!DOCTYPE doc [<!ELEMENT doc ANY>]><doc>', 'doc'],
  ])('recognizes %s', (source, name) => {
    expect(xmlTagToClose(source, '')).toBe(name)
  })

  test.each([
    '</div>',
    '<div/>',
    '<div />',
    '<div a=b/>',
    '<BR>',
    '<img src="x">',
    '<!-- <div>',
    '<!-- <div> -->',
    '<![CDATA[<div>',
    '<?xml <div>',
    '<!DOCTYPE doc [<div>',
    '<!DOCTYPE html>',
    '<>',
    '< div>',
    '<div a=>',
    '<div title="<tag>',
    '<div bad<name>',
    'x > y',
    '<123>',
  ])('ignores %s', (source) => {
    expect(xmlTagToClose(source, '')).toBeNull()
  })

  test.each([
    ['<div>', '</div>', null],
    ['<div>', 'body <div>nested</div></div>', null],
    ['<div><div>', '</div>', 'div'],
    ['<div><div>', '</div></div>', null],
    ['<div><div>', '<div></div></div>', 'div'],
    ['<div><div>', '<div></div></div></div>', null],
    ['<div>', '<!-- </div> -->', 'div'],
    ['<div>', '<span title="</div>">', 'div'],
    ['<div>', '</span>', 'div'],
  ])('reserves enclosing closers in %s | %s', (before, after, name) => {
    expect(xmlTagToClose(before, after)).toBe(name)
  })

  test.each([
    ['<custom-tag>', '</custom-tag>', true],
    ['  before <div title=">">', '</div> after', true],
    ['<ns:Tag>', '</ns:Tag>', true],
    ['<div> ', '</div>', false],
    ['<div>', ' </div>', false],
    ['<div>', '</span>', false],
    ['<!-- <div>', '</div>', false],
    ['<br>', '</br>', false],
  ])('recognizes an empty pair in %s | %s', (before, after, expected) => {
    expect(isEmptyXmlTagPair(before, after)).toBe(expected)
  })
})
