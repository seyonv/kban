export type Column = "backlog" | "sprint" | "in_progress" | "review" | "done";
export type CardType = "feature" | "bug" | "chore" | "spike";
export type Priority = 1 | 2 | 3 | 4 | 5;

export interface Card {
  id: number;
  short_id: string;
  title: string;
  description: string | null;
  column: Column;
  priority: Priority;
  type: CardType;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived: number;
  sort_order: number;
}

export interface DecisionLogEntry {
  id: number;
  card_id: number;
  decision: string;
  reasoning: string | null;
  created_at: string;
}

export interface ContextSnapshot {
  id: number;
  card_id: number;
  branch: string | null;
  commit_hash: string | null;
  notes: string | null;
  created_at: string;
}

export interface CardFile {
  card_id: number;
  file_path: string;
}

export const COLUMNS: Column[] = [
  "backlog",
  "sprint",
  "in_progress",
  "review",
  "done",
];

export const COLUMN_LABELS: Record<Column, string> = {
  backlog: "BACKLOG",
  sprint: "SPRINT",
  in_progress: "IN PROGRESS",
  review: "REVIEW",
  done: "DONE",
};
