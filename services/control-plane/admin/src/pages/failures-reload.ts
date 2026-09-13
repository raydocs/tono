/** Billing lives in `profiles`, not live/fleet. Fleet is disabled on Failures. */
export function reloadAfterFailuresNodeChange(world: {
  live: { reload: () => void };
  profiles: { reload: () => void };
}) {
  world.live.reload();
  world.profiles.reload();
}
