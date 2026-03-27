import type { Card, Column } from "./card";

export interface BoardView {
  projectName: string;
  lastActive: string | null;
  columns: Map<Column, Card[]>;
  totalCards: number;
}
