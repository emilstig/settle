import type { Metadata } from "next";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { countSavedByGroup, getGroups } from "@/lib/groups";
import { getHistory } from "@/lib/history";
import { getUserProviderIds } from "@/lib/providers";
import home from "../../home.module.css";
import { SubHeader } from "../sub-header";
import { HistoryView } from "./history-view";

export const metadata: Metadata = { title: "Historik" };

/**
 * Historik: what the user has seen, rated and turned down, the evidence
 * behind Din smak. A place to correct mistakes and to find rewatches.
 */
export default function HistoryPage() {
  return (
    <main className={home.main}>
      <SubHeader title="Historik" />
      <Suspense fallback={<p className={home.wait}>Hämtar din historik …</p>}>
        <History />
      </Suspense>
    </main>
  );
}

async function History() {
  const user = await getCurrentUser();
  const [groups, providerIds, saved] = await Promise.all([
    getGroups(),
    getUserProviderIds(),
    countSavedByGroup(user.id),
  ]);
  const items = await getHistory(user.id, providerIds);
  return (
    <HistoryView
      groups={groups.map(({ id, name, kind, youngest_age }) => ({
        id,
        name,
        kind,
        youngest_age,
        savedCount: saved.get(id) ?? 0,
      }))}
      items={items}
    />
  );
}
