import { randomUUID } from 'node:crypto'
import { resetObservations } from './observations'

/**
 * Mints this run's id and empties the observation sink before the first worker
 * starts, so a file left behind by an earlier run cannot satisfy the runtime
 * coverage rule. The id goes into the environment, which Playwright hands to
 * every worker it forks after this returns; globalTeardown reads the same
 * variable in this process.
 */
export default function globalSetup(): void {
  resetObservations(randomUUID())
}
