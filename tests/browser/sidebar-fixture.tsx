import { Sidebar } from '@/components/ui/sidebar'
import '@/globals.css'

export function SidebarFixture() {
  const side =
    new URLSearchParams(location.search).get('side') === 'right'
      ? 'right'
      : 'left'

  return (
    <Sidebar.Shell className="h-dvh">
      <Sidebar side={side} width={80} defaultCollapsed={false}>
        <Sidebar.Panel>
          <Sidebar.Collapsed>
            <Sidebar.Header className="items-center">
              <Sidebar.Toggle />
            </Sidebar.Header>
            <Sidebar.Content>Icons</Sidebar.Content>
            <Sidebar.Footer>Settings</Sidebar.Footer>
          </Sidebar.Collapsed>
          <Sidebar.Expanded>
            <Sidebar.Header>
              <Sidebar.Toggle />
              <button className="h-10">New session</button>
            </Sidebar.Header>
            <Sidebar.Content>
              {Array.from({ length: 40 }, (_, index) => (
                <div key={index} className="h-10 shrink-0">
                  Session {index + 1}
                </div>
              ))}
            </Sidebar.Content>
            <Sidebar.Footer>
              <button className="h-10">Agents</button>
              <button className="h-10">Settings</button>
            </Sidebar.Footer>
          </Sidebar.Expanded>
        </Sidebar.Panel>
      </Sidebar>
    </Sidebar.Shell>
  )
}
