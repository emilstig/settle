import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUserProviderIds } from "@/lib/providers";
import styles from "./app.module.css";

/** Protected shell. The proxy already bounces signed-out visitors; this verifies again. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={styles.shell}>
      <Suspense fallback={<div className={styles.loading} aria-busy="true" />}>
        <Gate>{children}</Gate>
      </Suspense>
    </div>
  );
}

async function Gate({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const providers = await getUserProviderIds();
  if (providers.length === 0) redirect("/onboarding/services");
  if (!user.onboarded) redirect("/onboarding");
  return <>{children}</>;
}
