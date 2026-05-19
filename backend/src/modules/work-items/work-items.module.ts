import { Module } from "@nestjs/common";

import { WorkItemsService } from "./work-items.service";

@Module({
  providers: [WorkItemsService],
  exports: [WorkItemsService],
})
export class WorkItemsModule {}
