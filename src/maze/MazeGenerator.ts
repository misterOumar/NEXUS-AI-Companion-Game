export interface MazeCell {
  col: number;
  row: number;
  walls: { N: boolean; E: boolean; S: boolean; W: boolean };
  visited: boolean;
  isStart: boolean;
  isExit: boolean;
  dataNode: boolean;
}

export type Dir = 'N' | 'E' | 'S' | 'W';

const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const DELTA: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

export class MazeGenerator {
  readonly cols: number;
  readonly rows: number;
  private grid: MazeCell[][];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.grid = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => ({
        col: c, row: r,
        walls: { N: true, E: true, S: true, W: true },
        visited: false,
        isStart: c === 0 && r === 0,
        isExit: c === cols - 1 && r === rows - 1,
        dataNode: false,
      }))
    );
  }

  generate(): MazeCell[][] {
    this.dfs(0, 0);

    // Reset visited so scene code can use it for player tracking
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        this.grid[r][c].visited = false;

    // Add extra loops (remove ~15% of remaining walls) for less linear feel
    const totalInterior = (this.cols - 1) * this.rows + this.cols * (this.rows - 1);
    const extraLoops = Math.floor(totalInterior * 0.12);
    for (let i = 0; i < extraLoops; i++) this.removeRandomWall();

    // Scatter data nodes — every ~5th cell, skipping start/exit
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.grid[r][c];
        if (!cell.isStart && !cell.isExit && count % 5 === 0) cell.dataNode = true;
        count++;
      }
    }

    return this.grid;
  }

  private dfs(col: number, row: number): void {
    this.grid[row][col].visited = true;
    const dirs = (['N', 'E', 'S', 'W'] as Dir[]).sort(() => Math.random() - 0.5);

    for (const dir of dirs) {
      const [dc, dr] = DELTA[dir];
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
      if (this.grid[nr][nc].visited) continue;

      this.grid[row][col].walls[dir] = false;
      this.grid[nr][nc].walls[OPPOSITE[dir]] = false;
      this.dfs(nc, nr);
    }
  }

  private removeRandomWall(): void {
    // Pick a random interior horizontal or vertical wall that still exists
    const tries = 20;
    for (let i = 0; i < tries; i++) {
      if (Math.random() < 0.5) {
        // Horizontal: S wall between (c,r) and (c,r+1)
        const r = Math.floor(Math.random() * (this.rows - 1));
        const c = Math.floor(Math.random() * this.cols);
        if (this.grid[r][c].walls.S) {
          this.grid[r][c].walls.S = false;
          this.grid[r + 1][c].walls.N = false;
          return;
        }
      } else {
        // Vertical: E wall between (c,r) and (c+1,r)
        const r = Math.floor(Math.random() * this.rows);
        const c = Math.floor(Math.random() * (this.cols - 1));
        if (this.grid[r][c].walls.E) {
          this.grid[r][c].walls.E = false;
          this.grid[r][c + 1].walls.W = false;
          return;
        }
      }
    }
  }

  getCell(col: number, row: number): MazeCell | null {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return this.grid[row][col];
  }

  // Remove the wall between (col,row) and its neighbor in dir.
  // Returns the wall ID string that was removed, or null if already open.
  removeWall(col: number, row: number, dir: Dir): string | null {
    const cell = this.grid[row][col];
    if (!cell.walls[dir]) return null;

    const [dc, dr] = DELTA[dir];
    const nc = col + dc;
    const nr = row + dr;

    cell.walls[dir] = false;
    const neighbor = this.getCell(nc, nr);
    if (neighbor) neighbor.walls[OPPOSITE[dir]] = false;

    return MazeGenerator.wallId(col, row, dir);
  }

  // Canonical wall ID — same wall always has the same ID regardless of which cell requests it
  static wallId(col: number, row: number, dir: Dir): string {
    if (dir === 'S') return `H_${col}_${row}`;      // horizontal wall below (c,r)
    if (dir === 'N') return `H_${col}_${row - 1}`;  // same as S of row-1
    if (dir === 'E') return `V_${col}_${row}`;       // vertical wall right of (c,r)
    return `V_${col - 1}_${row}`;                    // same as E of col-1
  }

  // Returns up to 4 wall IDs adjacent to a cell that still have a mesh (wall is closed)
  getClosedWallsOf(col: number, row: number): Array<{ id: string; dir: Dir }> {
    const cell = this.grid[row][col];
    const result: Array<{ id: string; dir: Dir }> = [];
    for (const dir of ['N', 'E', 'S', 'W'] as Dir[]) {
      if (!cell.walls[dir]) continue;
      const [dc, dr] = DELTA[dir];
      const nc = col + dc;
      const nr = row + dr;
      // Don't remove outer boundary walls
      if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
      result.push({ id: MazeGenerator.wallId(col, row, dir), dir });
    }
    return result;
  }
}
