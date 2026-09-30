/** A transition token embeds its deadline so both servers enforce the same lease. */
export function transitionActive(
  token: string | undefined,
  now = Date.now(),
): boolean {
  if (!token) return false
  const deadline = Number(token.split(':')[0])
  return Number.isFinite(deadline) && deadline > now
}
