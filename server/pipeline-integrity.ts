import { db } from "./db";
import { companyFlows, outreachPipeline } from "@shared/schema";
import { eq, and, sql, ne, isNull } from "drizzle-orm";
import { log } from "./logger";

const TAG = "pipeline-integrity";

export interface PipelineIntegrityReport {
  totalCompanyFlows: number;
  totalOutreachPipeline: number;
  orphanFlowCount: number;
  lowercaseInvalidPipelineStatusCount: number;
  crossClientDuplicateCompanyCount: number;
}

export async function reportPipelineIntegrity(clientId?: string): Promise<PipelineIntegrityReport> {
  const flowsWhere = clientId ? eq(companyFlows.clientId, clientId) : sql`1=1`;
  const pipelineWhere = clientId ? eq(outreachPipeline.clientId, clientId) : sql`1=1`;

  const [totalFlowsResult, totalPipelineResult, orphanResult, lowercaseResult, crossClientResult] =
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(companyFlows)
        .where(and(eq(companyFlows.status, "active"), ne(companyFlows.bestChannel, "discard"), flowsWhere)),
      db.select({ count: sql<number>`count(*)::int` }).from(outreachPipeline).where(pipelineWhere),
      db
        .select({ count: sql<number>`count(${companyFlows.id})::int` })
        .from(companyFlows)
        .leftJoin(
          outreachPipeline,
          and(
            eq(outreachPipeline.clientId, companyFlows.clientId),
            eq(outreachPipeline.companyId, companyFlows.companyId)
          )
        )
        .where(
          and(
            eq(companyFlows.status, "active"),
            ne(companyFlows.bestChannel, "discard"),
            flowsWhere,
            isNull(outreachPipeline.id)
          )
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(outreachPipeline)
        .where(
          and(
            pipelineWhere,
            sql`LOWER(COALESCE(${outreachPipeline.pipelineStatus}, '')) NOT IN ('active', 'completed', 'responded', 'not_interested')`
          )
        ),
      db
        .select({
          companyId: outreachPipeline.companyId,
          clientCount: sql<number>`count(DISTINCT ${outreachPipeline.clientId})::int`,
        })
        .from(outreachPipeline)
        .groupBy(outreachPipeline.companyId)
        .having(sql`count(DISTINCT ${outreachPipeline.clientId}) > 1`),
    ]);

  const totalCompanyFlows = totalFlowsResult[0]?.count ?? 0;
  const totalOutreachPipeline = totalPipelineResult[0]?.count ?? 0;
  const orphanFlowCount = orphanResult[0]?.count ?? 0;
  const lowercaseInvalidPipelineStatusCount = lowercaseResult[0]?.count ?? 0;
  const crossClientDuplicateCompanyCount = crossClientResult.length;

  const report: PipelineIntegrityReport = {
    totalCompanyFlows,
    totalOutreachPipeline,
    orphanFlowCount,
    lowercaseInvalidPipelineStatusCount,
    crossClientDuplicateCompanyCount,
  };

  log(
    `Pipeline integrity (${clientId ?? "all"}): flows=${totalCompanyFlows} pipeline=${totalOutreachPipeline} orphans=${orphanFlowCount} invalid_status=${lowercaseInvalidPipelineStatusCount} cross_client_dupes=${crossClientDuplicateCompanyCount}`,
    TAG
  );

  return report;
}
