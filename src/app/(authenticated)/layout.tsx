import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { TopBar } from "@/components/layout/top-bar"

/**
 * Auth is enforced here, not only in the middleware.
 *
 * Clerk's own guidance is that middleware path matching can diverge from how Next
 * actually routes a request, which leaves protected resources reachable. Every API
 * route already re-checks the session through `getCurrentUserId`, but the pages under
 * this group had no check of their own and relied entirely on the matcher. This makes
 * the middleware defence in depth rather than the only barrier.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
