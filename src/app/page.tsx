import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import {
  Activity,
  FileText,
  MessageSquare,
  ShieldCheck,
  TrendingUp,
  Lightbulb,
  ArrowRight,
  Heart,
} from "lucide-react"

export default async function LandingPage() {
  const { userId } = await auth()

  if (userId) {
    redirect("/dashboard")
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Activity className="size-5" />
            </div>
            <span className="text-xl font-semibold tracking-tight text-foreground">
              Tabeeb
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="rounded-lg px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center px-4 py-20 sm:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-1.5 text-sm text-muted-foreground">
            <Heart className="size-3.5 text-primary" />
            Your personal medical document vault
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            All your medical records,{" "}
            <span className="text-primary">understood by AI</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Tabeeb reads, organizes, and reasons over your complete medical
            history. Upload lab reports, prescriptions, and discharge summaries
            — then ask questions in plain English or Urdu.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
            >
              Start for Free
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border bg-muted/30 px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-3 text-center text-3xl font-bold tracking-tight text-foreground">
            Everything you need for your health
          </h2>
          <p className="mx-auto mb-12 max-w-lg text-center text-muted-foreground">
            Tabeeb turns scattered medical documents into an organized,
            intelligent health companion.
          </p>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/30"
              >
                <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <feature.icon className="size-5" />
                </div>
                <h3 className="mb-2 font-semibold text-foreground">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground">
            Take control of your medical history
          </h2>
          <p className="mt-4 text-muted-foreground">
            Stop digging through folders and filing cabinets. Let Tabeeb make
            sense of your health data.
          </p>
          <div className="mt-8">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
            >
              Create Your Vault
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-4 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <span className="text-sm font-medium text-foreground">
              Tabeeb
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Your health data stays yours. Always.
          </p>
        </div>
      </footer>
    </div>
  )
}

const features = [
  {
    title: "Document Vault",
    description:
      "Upload lab reports, prescriptions, imaging summaries, and discharge notes. Tabeeb extracts and organizes everything automatically.",
    icon: FileText,
  },
  {
    title: "Ask Tabeeb",
    description:
      "Ask questions about your medical history in plain English or Urdu. Get answers grounded in your actual documents with source citations.",
    icon: MessageSquare,
  },
  {
    title: "Safety Checks",
    description:
      "Automatically detect potential drug interactions, food conflicts, and contraindications across all your prescriptions.",
    icon: ShieldCheck,
  },
  {
    title: "Lab Trends",
    description:
      "Track lab values over time with automatic trend detection. Spot anomalies in blood work, vitals, and other metrics before they become problems.",
    icon: TrendingUp,
  },
  {
    title: "Health Insights",
    description:
      "Receive periodic AI-generated summaries of your health status, upcoming checkup reminders, and actionable recommendations.",
    icon: Lightbulb,
  },
  {
    title: "Privacy First",
    description:
      "Your medical data is encrypted and never shared. Tabeeb processes your documents securely and gives you full control over access.",
    icon: Activity,
  },
]
