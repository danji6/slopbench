export function isFilePermissionError(error: unknown) {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
}
