import alert from '../../../design/assets/Icons/alert.svg';
import arrowUp from '../../../design/assets/Icons/arrow-up.svg';
import bot from '../../../design/assets/Icons/bot.svg';
import broadcast from '../../../design/assets/Icons/broadcast.svg';
import check from '../../../design/assets/Icons/check.svg';
import checkCircle from '../../../design/assets/Icons/check-circle.svg';
import coins from '../../../design/assets/Icons/coins.svg';
import database from '../../../design/assets/Icons/database.svg';
import flask from '../../../design/assets/Icons/flask.svg';
import loop from '../../../design/assets/Icons/loop.svg';
import mask from '../../../design/assets/Icons/mask.svg';
import pause from '../../../design/assets/Icons/pause.svg';
import play from '../../../design/assets/Icons/play.svg';
import receipt from '../../../design/assets/Icons/receipt.svg';
import refresh from '../../../design/assets/Icons/refresh.svg';
import returnIcon from '../../../design/assets/Icons/return.svg';
import shield from '../../../design/assets/Icons/shield.svg';
import store from '../../../design/assets/Icons/store.svg';
import tag from '../../../design/assets/Icons/tag.svg';
import wallet from '../../../design/assets/Icons/wallet.svg';
import xCircle from '../../../design/assets/Icons/x-circle.svg';

const icons = {
  alert,
  'arrow-up': arrowUp,
  bot,
  broadcast,
  check,
  'check-circle': checkCircle,
  coins,
  database,
  flask,
  loop,
  mask,
  pause,
  play,
  receipt,
  refresh,
  return: returnIcon,
  shield,
  store,
  tag,
  wallet,
  'x-circle': xCircle,
} as const;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 24, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <span
      className="bd-icon"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url(${icons[name]})`,
        maskImage: `url(${icons[name]})`,
      }}
    />
  );
}
