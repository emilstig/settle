import type { Metadata } from "next";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getChosenGroupId } from "@/lib/group-choice";
import { countSavedByGroup, getGroups } from "@/lib/groups";
import { getList } from "@/lib/list";
import { getUserProviderIds } from "@/lib/providers";
import home from "../home.module.css";
import { ListView } from "./list-view";

export const metadata: Metadata = { title: "Att se" };

/** Att se: what the chosen group can watch from here on, as shelves. */
export default function ListPage() {
  return (
    <main className={home.main}>
      <Suspense fallback={<p className={home.wait}>Hämtar din lista …</p>}>
        <List />
      </Suspense>
    </main>
  );
}

async function List() {
  const user = await getCurrentUser();
  const [groups, providerIds, saved] = await Promise.all([
    getGroups(),
    getUserProviderIds(),
    countSavedByGroup(user.id),
  ]);
  const groupId = await getChosenGroupId(groups);
  const items = await getList(user.id, groupId, providerIds);
  return (
    <ListView
      // A new group is a new list: start over with its own state.
      key={groupId}
      groups={groups.map(({ id, name, kind, youngest_age }) => ({
        id,
        name,
        kind,
        youngest_age,
        savedCount: saved.get(id) ?? 0,
      }))}
      groupId={groupId}
      items={items}
    />
  );
}
