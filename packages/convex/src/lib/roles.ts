export const ROLES = ['user', 'moderator', 'admin'] as const

export type Role = (typeof ROLES)[number]

export const ROLE = ROLES.reduce(
  (acc, role, index) => {
    acc[role] = index + 1
    return acc
  },
  {} as Record<Role, number>,
)

export function minRole(
  role: Role | undefined | null,
  required: Role,
): boolean {
  return !!role && ROLE[role] >= ROLE[required]
}
