export type GroupOption = {
  id: string;
  name: string;
  kind: string;
  youngest_age: number | null;
  /** Titles on the group's list, shown on the tile. */
  savedCount: number;
};

export type ToastButton = { label: string; onClick: () => void };
export type ToastState = {
  id: number;
  text: string;
  buttons: ToastButton[];
  ms: number;
  onTimeout?: () => void;
};
