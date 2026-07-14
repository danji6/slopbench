import { createUsableContext } from '@/hooks'
import { cn } from '@/lib/utils'
import { truncateToExtension } from '@sb/core/utils/strings'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckIcon,
  CircleOffIcon,
  FileIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react'
import { useImperativeHandle, useMemo, useState } from 'react'
import { type FileWithPath, useDropzone as _useDropzone } from 'react-dropzone'

import { Overlay, T } from '.'

const [DropZoneContext, useDropZone] = createUsableContext<
  ReturnType<typeof _useDropzone> & {
    ref?: React.RefObject<HTMLInputElement | null>
    isDisabled?: boolean
    selectedFiles: readonly FileWithPath[]
  }
>('DropZone')

export { useDropZone }

export type DropZoneProps = Parameters<typeof _useDropzone>[0] & {
  ref?: React.RefObject<DropZoneHandle | null>
  noFocus?: boolean
  noInputEvents?: boolean
  className?: string
  style?: React.CSSProperties
  onClick?: ((event: React.MouseEvent<HTMLElement>) => void) | null
  onKeyDown?: ((event: React.KeyboardEvent<HTMLElement>) => void) | null
  children?: React.ReactNode
}

export type DropZoneHandle = {
  clear: () => void
  open: () => void // opens the file picker dialog
  input: HTMLInputElement | null
}

export function FilePickerOverlay({ className }: { className?: string }) {
  const { isDragActive, isDragAccept, isDragReject } = useDropZone()

  return (
    <Overlay
      show={isDragActive}
      className={cn(
        'bg-m3-surface-container-low/50 outline-ring z-39 rounded-2xl outline-2 outline-offset-1 backdrop-blur-sm outline-dashed *:select-none',
        className,
      )}
    >
      {isDragAccept && <DropToUploadMessage className="text-m3-on-surface" />}
      {isDragReject && <NotSupportedMessage className="text-m3-on-surface" />}
    </Overlay>
  )
}

export function FilePickerBox({
  disabledMessage,
  disabledIcon,
  className,
}: {
  disabledMessage?: string
  disabledIcon?: React.ReactNode
  className?: string
}) {
  const {
    isDragActive,
    isDragAccept,
    isDragReject,
    isDisabled,
    selectedFiles,
  } = useDropZone()

  return (
    <div
      className={cn(
        'bg-muted flex h-60 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-[border-color]',
        isDisabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:border-ring focus-visible:border-ring',
        !isDisabled && isDragActive && 'border-ring',
        className,
      )}
    >
      <AnimatePresence>
        {isDisabled ? (
          <DisabledMessage message={disabledMessage} icon={disabledIcon} />
        ) : isDragAccept ? (
          <SupportedMessage />
        ) : isDragReject ? (
          <NotSupportedMessage />
        ) : selectedFiles.length > 0 ? (
          <PickedMessage files={selectedFiles} />
        ) : (
          <DropToUploadMessage />
        )}
      </AnimatePresence>
    </div>
  )
}

export function DropZone({
  ref: externalRef,
  className,
  style,
  children,
  disabled,
  noFocus,
  noInputEvents,
  onDrop,
  onClick,
  onKeyDown,
  ...props
}: DropZoneProps) {
  const [selectedFiles, setSelectedFiles] = useState<readonly FileWithPath[]>(
    [],
  )

  const dropZone = _useDropzone({
    disabled,
    ...props,
    onDrop: (acceptedFiles, fileRejections, event) => {
      setSelectedFiles(acceptedFiles)
      onDrop?.(acceptedFiles, fileRejections, event)
    },
  })
  const {
    onClick: _onClick,
    tabIndex: dropzoneTabIndex,
    ...rootProps
  } = dropZone.getRootProps()
  const internalRef = dropZone.inputRef

  useImperativeHandle(
    externalRef,
    () => ({
      clear: () => {
        setSelectedFiles([])
        if (internalRef.current) {
          internalRef.current.value = ''
        }
      },
      input: internalRef.current,
      open: () => {
        // Reset so picking the same file again works
        if (internalRef.current) internalRef.current.value = ''
        internalRef.current?.click()
      },
    }),
    [internalRef],
  )

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (onClick !== undefined) {
      onClick?.(e)
    } else {
      _onClick?.(e)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (onKeyDown !== undefined) {
      onKeyDown?.(e)
    } else if (e.key === 'Enter' || e.key === ' ') {
      // Trigger click behavior on Enter or Space key
      e.preventDefault()
      e.currentTarget.click()
    }
  }

  return (
    <DropZoneContext.Provider
      value={{
        ...dropZone,
        ref: internalRef,
        isDisabled: disabled,
        selectedFiles,
      }}
    >
      <section
        aria-label="File upload drop zone"
        data-slot="file-picker"
        tabIndex={noFocus || disabled ? -1 : (dropzoneTabIndex ?? 0)}
        className={cn(
          'relative isolate flex w-full justify-center outline-none',
          'focus-visible:ring-ring rounded-2xl transition-shadow focus-visible:ring-1 focus-visible:outline-2',
          className,
        )}
        style={style}
        {...rootProps}
        onClick={noInputEvents ? undefined : handleClick}
        onKeyDown={noInputEvents ? undefined : handleKeyDown}
        aria-disabled={disabled}
      >
        <input
          name="attachment"
          type="file"
          // eslint-disable-next-line react-hooks/refs
          {...dropZone.getInputProps()}
          className="hidden"
        />
        {children}
      </section>
    </DropZoneContext.Provider>
  )
}

function DropToUploadMessage({ className }: { className?: string }) {
  return (
    <Message className={className}>
      <UploadIcon /> Drop to upload
    </Message>
  )
}

function PickedMessage({
  files,
  className,
}: {
  files: readonly FileWithPath[]
  className?: string
}) {
  const truncated = useMemo(
    () =>
      files
        .slice(0, 3)
        .map((it) => [it, truncateToExtension(it.name, 20)] as const),
    [files],
  )

  return (
    <Message className={className}>
      <FileIcon />
      <ul className="list-none">
        {truncated.map(([file, truncated]) => (
          <li key={file.name} title={file.name}>
            {truncated}
          </li>
        ))}
        {files.length > 3 && (
          <li className="text-center tracking-widest">...</li>
        )}
      </ul>
    </Message>
  )
}

function SupportedMessage({ className }: { className?: string }) {
  return (
    <Message className={className}>
      <CheckIcon /> Drop to upload
    </Message>
  )
}

function NotSupportedMessage({ className }: { className?: string }) {
  return (
    <Message className={className}>
      <XIcon /> Not supported
    </Message>
  )
}

function DisabledMessage({
  message = 'Disabled',
  icon = <CircleOffIcon />,
  className,
}: {
  message?: string
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <Message className={className}>
      {icon} {message}
    </Message>
  )
}

function Message({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
    >
      <T.muted
        className={cn(
          'text-md flex flex-col items-center gap-2 select-none',
          className,
        )}
      >
        {children}
      </T.muted>
    </motion.div>
  )
}
