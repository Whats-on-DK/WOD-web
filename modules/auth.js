export const ADMIN_ROLES = ['admin', 'super_admin'];
export const ADMIN_SESSION_KEY = 'wodAdminSession';
export const getUserRoles = (user) => {
  const roles = user?.app_metadata?.roles;
  return Array.isArray(roles) ? roles : [];
};

export const hasAdminRole = (user) => {
  const roles = getUserRoles(user);
  return roles.some((role) => ADMIN_ROLES.includes(role));
};

export const isSuperAdmin = (user) => getUserRoles(user).includes('super_admin');

export const getIdentityToken = async () => {
  if (!window.netlifyIdentity?.currentUser) return null;
  const user = window.netlifyIdentity.currentUser();
  if (!user) return null;
  if (typeof user.jwt === 'function') {
    try {
      return await user.jwt();
    } catch (error) {
      try {
        // Retry once with forced refresh; Netlify Identity can fail transiently.
        return await user.jwt(true);
      } catch (refreshError) {
        return user?.token?.access_token || null;
      }
    }
  }
  return user?.token?.access_token || null;
};
