import { useEffect, useState } from 'react';
import { resolveUserAvatar, type UserAvatarCandidate } from '../../lib/avatar';

export interface UserAvatarProps {
  user?: UserAvatarCandidate | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps['size']>, string> = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-10 w-10 text-xs',
  lg: 'h-12 w-12 text-sm',
  xl: 'h-20 w-20 text-xl',
};

export function UserAvatar({ user, size = 'sm', className = '' }: UserAvatarProps) {
  const resolved = resolveUserAvatar(user);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [resolved.url]);

  const sizeClass = SIZE_CLASSES[size];
  const displayUrl = !imgFailed ? resolved.url : null;
  const label = user?.name ? `${user.name} avatar` : 'User avatar';

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#DCE6F7] bg-gradient-to-br from-[#1155EE] to-[#2B6FFF] font-display font-bold text-white shadow-2xs select-none ${sizeClass} ${className}`}
    >
      {displayUrl ? (
        <img
          src={displayUrl}
          alt={label}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{resolved.initials}</span>
      )}
    </span>
  );
}
