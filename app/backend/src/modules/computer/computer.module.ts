import { Module } from "@nestjs/common";

import { ComputerControlService } from "./computer-control.service";

@Module({
  providers: [ComputerControlService],
  exports: [ComputerControlService],
})
export class ComputerModule {}
