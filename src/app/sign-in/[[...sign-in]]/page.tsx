import { SignIn } from "@clerk/nextjs";
import { TabeebLogo } from "@/components/brand";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4">
      {/* Branding */}
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <TabeebLogo variant="stacked" size="md" href="/" priority />
        <p className="text-sm text-gray-500">
          Your personal medical document vault
        </p>
      </div>

      {/* Clerk SignIn Component */}
      <SignIn
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "shadow-lg border border-gray-100",
            headerTitle: "text-gray-900",
            headerSubtitle: "text-gray-500",
            formButtonPrimary:
              "bg-emerald-600 hover:bg-emerald-700 text-white",
            footerActionLink: "text-emerald-600 hover:text-emerald-700",
            formFieldInput:
              "border-gray-200 focus:border-emerald-500 focus:ring-emerald-500",
            identityPreviewText: "text-gray-600",
          },
        }}
      />

      {/* Footer */}
      <p className="mt-8 text-xs text-gray-400">
        AI-powered medical document management
      </p>
    </div>
  );
}
