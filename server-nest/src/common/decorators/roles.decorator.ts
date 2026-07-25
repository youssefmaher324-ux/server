import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
/** Usage: @Roles('admin', 'employee') on a controller method. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
