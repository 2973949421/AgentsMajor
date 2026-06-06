#!/usr/bin/env node

import { runDust2NodeShadowExperiment } from "../packages/core/dist/node-shadow-experiment.js";

const result = runDust2NodeShadowExperiment();

console.log(
  JSON.stringify(
    {
      source: result.summary.source,
      status: result.summary.status,
      roundId: result.summary.roundId,
      phaseCount: result.summary.phaseCount,
      finalWinnerSide: result.summary.finalWinnerSide,
      finalWinnerTeamId: result.summary.finalWinnerTeamId,
      finalRoundWinType: result.summary.finalRoundWinType,
      finalBombState: result.summary.finalBombState,
      activeNodeCount: result.summary.activeNodeCount,
      endedEarly: result.summary.endedEarly,
      reportSource: result.report.source,
      callsLlm: result.report.audit.callsLlm,
      writesDb: result.report.audit.writesDb,
      replacesLegacyRoundPath: result.report.audit.replacesLegacyRoundPath
    },
    null,
    2
  )
);
