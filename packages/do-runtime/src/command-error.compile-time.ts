import type { CommandError } from '@hospai/contracts';

function _rejectBogus(): void {
  const bogus = 'totally_made_up' as string;
  // @ts-expect-error not assignable to CommandError
  const _bad: CommandError = bogus;
}
void _rejectBogus;
