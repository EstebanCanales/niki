import { Injectable, Logger } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { WorkItem } from "../../domain/contracts";

type LocalDbState = {
  workItems: WorkItem[];
};

const DEFAULT_STATE: LocalDbState = {
  workItems: [],
};

@Injectable()
export class LocalDbService {
  private readonly logger = new Logger(LocalDbService.name);
  private readonly filePath = join(process.cwd(), ".niki", "local-db.json");
  private state: LocalDbState = structuredClone(DEFAULT_STATE);

  constructor() {
    this.state = this.readState();
  }

  getWorkItems() {
    return structuredClone(this.state.workItems);
  }

  saveWorkItems(items: WorkItem[]) {
    this.state.workItems = structuredClone(items);
    this.flush();
  }

  private readState() {
    try {
      if (!existsSync(this.filePath)) {
        this.ensureParentDir();
        this.flush();
        return structuredClone(DEFAULT_STATE);
      }
      const raw = readFileSync(this.filePath, "utf8");
      if (!raw.trim()) return structuredClone(DEFAULT_STATE);
      const parsed = JSON.parse(raw) as Partial<LocalDbState>;
      return {
        workItems: Array.isArray(parsed.workItems) ? parsed.workItems : [],
      };
    } catch (error) {
      this.logger.warn(`local db load failed, using defaults: ${String(error)}`);
      return structuredClone(DEFAULT_STATE);
    }
  }

  private flush() {
    try {
      this.ensureParentDir();
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
    } catch (error) {
      this.logger.error(`local db flush failed: ${String(error)}`);
    }
  }

  private ensureParentDir() {
    mkdirSync(dirname(this.filePath), { recursive: true });
  }
}
