import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50">
      {/* Branding */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2.5">
          <svg
            className="h-9 w-9 text-emerald-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.707 50.707 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"
            />
          </svg>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Tabeeb
          </h1>
        </div>
        <p className="text-sm text-gray-500">
          Create your account to get started
        </p>
      </div>

      {/* Clerk SignUp Component */}
      <SignUp
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
