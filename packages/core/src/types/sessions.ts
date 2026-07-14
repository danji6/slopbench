export type SessionParticipant<
  UserId extends string = string,
  AgentId extends string = string,
  AvatarId extends string = string,
> = {
  id: UserId | AgentId
  kind: 'user' | 'agent'
  name: string
  avatarId?: AvatarId
}

export type SessionListItem<
  Session extends { _id: string } = { _id: string },
  UserId extends string = string,
  AgentId extends string = string,
  AvatarId extends string = string,
> = Session & {
  participants: SessionParticipant<UserId, AgentId, AvatarId>[]
  hidden?: boolean // the current user hid this session from their sidebar
}

export type SessionMember<Membership, User, Settings> = {
  membership: Membership
  user: User | null
  settings: Settings | null
}
