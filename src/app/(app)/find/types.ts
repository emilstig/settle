export type GroupOption = { id: string; name: string; kind: string };

export type ToastButton = { label: string; onClick: () => void };
export type ToastState = {
  id: number;
  text: string;
  buttons: ToastButton[];
  ms: number;
  onTimeout?: () => void;
};
