// Every function here moves credits in ONE SQL statement, so the credit change
// and the job/project state change commit together or not at all. A crash or
// timeout between two separate statements can otherwise lose a refund, or
// charge a user for a job that was never recorded.

// A job still STARTING (no provider task ID) after this long belongs to a
// request that died (generate has maxDuration=60s), so its credits come back.
export const STUCK_JOB_MINUTES = 10;

// Debits the user and creates the job row atomically.
// Returns the remaining balance, or null if the user cannot afford it.
export async function debitAndCreateJob(sql, job) {
  const rows = await sql`
    WITH debit AS (
      UPDATE users SET credits = credits - ${job.cost}::int
      WHERE id = ${job.userId} AND credits >= ${job.cost}::int
      RETURNING credits
    ), created AS (
      INSERT INTO jobs (id, user_id, source_key, secondary_source_key, mode, prompt,
                        duration_seconds, cost, status, provider)
      SELECT ${job.id}::uuid, ${job.userId}::text, ${job.sourceKey}::text, ${job.secondaryKey}::text,
             ${job.mode}::text, ${job.prompt}::text, ${job.seconds}::int, ${job.cost}::int,
             'STARTING', ${job.provider}::text
      FROM debit
      RETURNING id
    )
    SELECT debit.credits AS remaining FROM debit, created`;
  return rows.length ? Number(rows[0].remaining) : null;
}

// Marks an unfinished job FAILED and refunds its cost exactly once.
// Returns true if this call performed the refund.
export async function failAndRefundJob(sql, jobId, message) {
  const rows = await sql`
    WITH failed AS (
      UPDATE jobs SET status = 'FAILED', error_message = ${message}::text
      WHERE id = ${jobId}::uuid AND status NOT IN ('FAILED', 'SUCCEEDED')
      RETURNING user_id, cost
    )
    UPDATE users u SET credits = u.credits + f.cost
    FROM failed f WHERE u.id = f.user_id
    RETURNING u.credits`;
  return rows.length > 0;
}

// Refunds a job whose start request died before the provider task ID was saved.
// Returns true if the job was stuck and has now been failed and refunded.
export async function refundStuckJob(sql, jobId) {
  const rows = await sql`
    WITH failed AS (
      UPDATE jobs SET status = 'FAILED', error_message = 'Generation could not start'
      WHERE id = ${jobId}::uuid AND status = 'STARTING' AND runway_id IS NULL
        AND created_at < now() - make_interval(mins => ${STUCK_JOB_MINUTES}::int)
      RETURNING user_id, cost
    )
    UPDATE users u SET credits = u.credits + f.cost
    FROM failed f WHERE u.id = f.user_id
    RETURNING u.credits`;
  return rows.length > 0;
}

// Debits the user and records the charge on a SUBMITTING swap project atomically,
// so a later failure can always refund exactly what was taken.
// Returns the remaining balance, or null if the user cannot afford it.
export async function debitForSwap(sql, { projectId, userId, cost }) {
  const rows = await sql`
    WITH debit AS (
      UPDATE users SET credits = credits - ${cost}::int
      WHERE id = ${userId} AND credits >= ${cost}::int
        AND EXISTS (SELECT 1 FROM swap_projects
                    WHERE id = ${projectId}::uuid AND user_id = ${userId} AND status = 'SUBMITTING')
      RETURNING credits
    ), held AS (
      UPDATE swap_projects SET credits_charged = ${cost}::int
      FROM debit WHERE swap_projects.id = ${projectId}::uuid
      RETURNING swap_projects.id
    )
    SELECT debit.credits AS remaining FROM debit, held`;
  return rows.length ? Number(rows[0].remaining) : null;
}

// Render submission failed: give the charge back and let the user retry.
// Matches only while the project still holds this charge, so it cannot
// double-refund against the status poller's failure refund.
export async function releaseSwapCharge(sql, { projectId, userId, cost }) {
  await sql`
    WITH reset AS (
      UPDATE swap_projects SET status = 'READY', credits_charged = 0
      WHERE id = ${projectId}::uuid AND user_id = ${userId}
        AND status = 'SUBMITTING' AND credits_charged = ${cost}::int
      RETURNING user_id
    )
    UPDATE users u SET credits = u.credits + ${cost}::int
    FROM reset WHERE u.id = reset.user_id`;
}

// Provider reported failure: mark the project FAILED and refund whatever it holds, once.
export async function failAndRefundSwap(sql, projectId, message) {
  await sql`
    WITH failed AS (
      UPDATE swap_projects SET status = 'FAILED', error_message = ${message}::text
      WHERE id = ${projectId}::uuid AND status NOT IN ('FAILED', 'SUCCEEDED')
      RETURNING user_id, credits_charged
    )
    UPDATE users u SET credits = u.credits + f.credits_charged
    FROM failed f WHERE u.id = f.user_id AND f.credits_charged > 0`;
}
