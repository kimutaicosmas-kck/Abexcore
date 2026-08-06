import { resolveUploadUrl } from '../../utils/uploads';

type UserAvatarProps = {
  firstName?: string | null;
  lastName?: string | null;
  avatar?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const SIZE = {
  sm: 'h-9 w-9 text-xs rounded-full',
  md: 'h-12 w-12 text-sm rounded-full',
  lg: 'h-16 w-16 text-xl rounded-full',
} as const;

export function UserAvatar({
  firstName,
  lastName,
  avatar,
  size = 'sm',
  className = '',
}: UserAvatarProps) {
  const initials =
    `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || 'U';
  const src = resolveUploadUrl(avatar);
  const base = `${SIZE[size]} shrink-0 overflow-hidden flex items-center justify-center font-bold ${className}`;

  if (src) {
    return (
      <img
        src={src}
        alt={`${firstName || ''} ${lastName || ''}`.trim() || 'Profile photo'}
        className={`${base} object-cover bg-primary-100`}
      />
    );
  }

  return (
    <div className={`${base} bg-primary-600 text-white`}>
      {initials}
    </div>
  );
}
