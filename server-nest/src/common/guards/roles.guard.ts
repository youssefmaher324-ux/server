import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length && !requiredPermissions?.length) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user; // attached by JwtAuthGuard/JwtStrategy

    // Driver tokens carry a literal `role: 'driver'` string instead of a
    // roleId — drivers aren't in the User/Role/Permission tables at all.
    // Permission-level checks don't apply to them (they only ever gate on
    // the role name), so this branch never consults the Role table.
    if (user?.role && !user?.roleId) {
      if (requiredPermissions?.length) {
        throw new ForbiddenException('Driver accounts do not have fine-grained permissions');
      }
      if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
        throw new ForbiddenException('Insufficient role');
      }
      return true;
    }

    if (!user?.roleId) throw new ForbiddenException('No role assigned');

    const role = await this.prisma.role.findUnique({
      where: { id: user.roleId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new ForbiddenException('Role not found');

    if (requiredRoles?.length && !requiredRoles.includes(role.name)) {
      throw new ForbiddenException('Insufficient role');
    }

    if (requiredPermissions?.length) {
      const grantedKeys = new Set(role.permissions.map((rp) => rp.permission.key));
      const missing = requiredPermissions.filter((p) => !grantedKeys.has(p));
      if (missing.length) throw new ForbiddenException(`Missing permissions: ${missing.join(', ')}`);
    }

    return true;
  }
}
