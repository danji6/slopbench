import { Component, type ReactNode, type RefObject } from 'react'

type ShellExitFocusProps = {
  jobId: string | undefined
  exited: boolean
  wasInteractive: boolean
  terminalRef: RefObject<HTMLDivElement | null>
  onExitWithFocus?: (input: HTMLElement) => void
  children: ReactNode
}

/** Reads focus before the exit update can collapse or remove the terminal. */
export class ShellExitFocus extends Component<ShellExitFocusProps> {
  getSnapshotBeforeUpdate(previous: ShellExitFocusProps): HTMLElement | null {
    const { jobId, exited, terminalRef, onExitWithFocus } = this.props
    const jobJustExited = exited && !previous.exited && jobId === previous.jobId
    if (!jobJustExited || !previous.wasInteractive || !onExitWithFocus) return null // prettier-ignore
    if (!document.hasFocus()) return null

    const active = document.activeElement
    if (
      active instanceof HTMLElement &&
      terminalRef.current?.contains(active)
    ) {
      return active
    }
    return null
  }

  componentDidUpdate(
    _previous: ShellExitFocusProps,
    _state: unknown,
    input: HTMLElement | null,
  ) {
    if (input) this.props.onExitWithFocus?.(input)
  }

  render() {
    return this.props.children
  }
}
