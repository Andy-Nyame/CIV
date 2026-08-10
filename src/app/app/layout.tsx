import { AppShell } from "@/components/layout/app-shell";

export default function CivAppLayout({ children }: LayoutProps<"/app">) {
  return <AppShell>{children}</AppShell>;
}
