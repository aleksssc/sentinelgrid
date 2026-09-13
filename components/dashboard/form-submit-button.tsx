"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const variants = { primary: "sg-button-primary", secondary: "sg-button-secondary", danger: "sg-button-danger" };
const sizes = { default: "", sm: "sg-button-sm", icon: "sg-button-icon" };

type Props = Omit<ComponentProps<"button">, "type"> & {
  pendingLabel?: string;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function FormSubmitButton({ children, pendingLabel = "Saving...", variant = "primary", size = "default", className, disabled, ...props }: Props) {
  const { pending } = useFormStatus();
  return (
    <button {...props} type="submit" disabled={disabled || pending} aria-busy={pending}
      className={cn("sg-button", variants[variant], sizes[size], className)}>
      {pending && <Loader2 size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
      {pending ? pendingLabel : children}
    </button>
  );
}
