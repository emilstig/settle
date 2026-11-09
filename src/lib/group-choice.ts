import "server-only";
import { cookies } from "next/headers";
import { GROUP_COOKIE } from "./group-cookie";

/**
 * The group chosen last, shared by Hitta and Att se: the group is the app's
 * mode, not a filter on one page. Falls back to the first group.
 */
export async function getChosenGroupId(
  groups: { id: string }[],
): Promise<string> {
  const chosen = (await cookies()).get(GROUP_COOKIE)?.value;
  return groups.some((g) => g.id === chosen) ? chosen! : (groups[0]?.id ?? "");
}
