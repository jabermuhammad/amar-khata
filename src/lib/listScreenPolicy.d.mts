export type ListScreenStateInput = {
  rows: readonly unknown[];
  localLoading: boolean;
  remoteLoading: boolean;
  localError: string | null;
  remoteError: string | null;
};

export function getListScreenState(input: ListScreenStateInput): 'content' | 'loading' | 'error' | 'empty';
