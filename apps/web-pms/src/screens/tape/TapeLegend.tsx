import { AlertCircleIcon, LogOutIcon } from '../../shell/icons.js';

/** The tape's shapes with their words. Due out and overstay carry the bar's own mark. */
export function TapeLegend() {
  return (
    <div className="tape-legend" aria-label="Stay legend">
      <span>
        <i className="ui-stay ui-stay--inhouse" aria-hidden /> In house
      </span>
      <span>
        <i className="ui-stay ui-stay--due" aria-hidden>
          <LogOutIcon size={10} />
        </i>{' '}
        Due out today
      </span>
      <span>
        <i className="ui-stay ui-stay--overstay" aria-hidden>
          <AlertCircleIcon size={10} />
        </i>{' '}
        Overstay
      </span>
      <span>
        <i className="ui-stay ui-stay--confirmed" aria-hidden /> Confirmed
      </span>
      <span>
        <i className="ui-stay ui-stay--pending" aria-hidden /> Pending
      </span>
      <span>
        <i className="ui-stay ui-stay--blocked" aria-hidden /> Maintenance
      </span>
      <span>
        <i className="room-cond room-cond--billed" aria-hidden /> Billed
      </span>
      <span>
        <i className="room-cond room-cond--dirty" aria-hidden /> Dirty today
      </span>
      <span>
        <i className="tape-legend__free" aria-hidden /> Free
      </span>
    </div>
  );
}
