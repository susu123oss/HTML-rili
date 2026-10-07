export const avatarKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export const toPublicUser = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  role: user.role,
  jobTitle: user.jobTitle,
  departmentId: user.departmentId,
  departmentName: user.departmentName,
  avatarUrl: avatarKeyPattern.test(user.avatarKey || '') ? `/api/avatars/${user.avatarKey}` : ''
});
