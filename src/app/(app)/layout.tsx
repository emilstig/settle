import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, requireExistingUser } from "@/lib/auth";
import { TabBar } from "@/components/tab-bar/tab-bar";
import { getUserProviderIds } from "@/lib/providers";
import { DeckMemoryProvider } from "./find/deck-memory";
import styles from "./app.module.css";

/** Protected shell. The proxy already bounces signed-out visitors; this verifies again. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={styles.shell}>
      {/* Keeps the deck in Hitta while the user looks at another tab. */}
      <DeckMemoryProvider>
        <Suspense
          fallback={<div className={styles.loading} aria-busy="true" />}
        >
          <Gate>{children}</Gate>
        </Suspense>
        <TabBar />
      </DeckMemoryProvider>
    </div>
  );
}

async function Gate({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const providers = await getUserProviderIds();
  if (providers.length === 0) {
    await requireExistingUser();
    redirect("/onboarding/services");
  }
  if (!user.onboarded) redirect("/onboarding");
  return <>{children}</>;
}
