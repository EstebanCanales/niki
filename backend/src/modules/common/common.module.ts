import { Global, Module } from "@nestjs/common";

import { AppConfigService } from "./app-config.service";
import { LocalDbService } from "./local-db.service";
import { RuntimeStateService } from "./runtime-state.service";
import { UserMemoryService } from "./user-memory.service";

@Global()
@Module({
  providers: [AppConfigService, RuntimeStateService, UserMemoryService, LocalDbService],
  exports: [AppConfigService, RuntimeStateService, UserMemoryService, LocalDbService],
})
export class CommonModule {}
