import Augur from "augur.js";
import * as Knex from "knex";
import { NetworkConfiguration } from "augur-core";
import { runServer, RunServerResult, shutdownServers } from "./server/run-server";
import { bulkSyncAugurNodeWithBlockchain } from "./blockchain/bulk-sync-augur-node-with-blockchain";
import { startAugurListeners } from "./blockchain/start-augur-listeners";
import { createDbAndConnect } from "./setup/check-and-initialize-augur-db";
import { clearOverrideTimestamp } from "./blockchain/process-block";
import { processQueue } from "./blockchain/process-queue";
import { ErrorCallback, ServersData } from "./types";

export class AugurNodeController {
  private augur: Augur;
  private networkConfig: NetworkConfiguration;
  private running: boolean;
  private db: Knex|undefined;
  private serverResult: RunServerResult|undefined;
  private errorCallback: ErrorCallback|undefined;

  constructor(augur: Augur, networkConfig: NetworkConfiguration) {
    this.augur = augur;
    this.networkConfig = networkConfig;
    this.running = false;
  }

  public async start(errorCallback: ErrorCallback|undefined) {
    this.running = true;
    this.errorCallback = errorCallback;
    this.db = await createDbAndConnect(this.augur, this.networkConfig);
    const handoffBlockNumber = await bulkSyncAugurNodeWithBlockchain(this.db, this.augur);
    console.log("Bulk sync with blockchain complete.");
    this.serverResult = runServer(this.db, this.augur);
    startAugurListeners(this.db, this.augur, handoffBlockNumber + 1, this.shutdownCallback);
  }

  public shutdown() {
    if (!this.running) return;
    this.running = false;
    console.log("Stopping Augur Node Server");
    processQueue.pause();
    if (this.serverResult !== undefined) {
      const servers = this.serverResult.servers;
      shutdownServers(servers);
      this.serverResult = undefined;
    }
    if (this.db !== undefined) {
      this.db.destroy();
      this.db = undefined;
    }
    clearOverrideTimestamp();
    this.augur = new Augur();
  }

  private shutdownCallback(err: Error|null) {
    if (err == null) return;
    console.error("Fatal Error, shutting down servers", err);
    if (this.errorCallback) this.errorCallback(err);
    if (this.serverResult !== undefined) shutdownServers(this.serverResult.servers);
    process.exit(1);
  }
}
