"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon, InformationCircleIcon, Alert02Icon, MultiplicationSignCircleIcon } from "@hugeicons/core-free-icons"
import { Spinner } from "./spinner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      icons={{
        success: (
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4" />
        ),
        info: (
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="size-4" />
        ),
        warning: (
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-4" />
        ),
        error: (
          <HugeiconsIcon icon={MultiplicationSignCircleIcon} strokeWidth={2} className="size-4" />
        ),
        loading: <Spinner />,
      }}
      style={
        {
          "--normal-bg": "var(--background)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--success-bg": "var(--background)",
          "--success-text": "var(--foreground)",
          "--success-border": "var(--border)",
          "--info-bg": "var(--background)",
          "--info-text": "var(--foreground)",
          "--info-border": "var(--border)",
          "--warning-bg": "var(--background)",
          "--warning-text": "var(--foreground)",
          "--warning-border": "var(--border)",
          "--error-bg": "var(--background)",
          "--error-text": "var(--foreground)",
          "--error-border": "var(--border)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "bg-background text-foreground border border-border shadow-none",
          title: "text-foreground",
          description: "text-muted-foreground",
          actionButton:
            "bg-foreground text-background shadow-none",
          cancelButton:
            "bg-muted text-muted-foreground shadow-none",
          icon: "text-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
