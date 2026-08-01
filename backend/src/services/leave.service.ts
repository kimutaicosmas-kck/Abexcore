import { LeaveStatus } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { requireTenantId } from '../utils/tenant';
import { generateNumber } from '../utils/date';
import { NotificationService } from './notification.service';

function formatLeaveRange(start: Date, end: Date) {
  return `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`;
}

export class LeaveService {
  /** Ensure a system user is not already linked to a different employee. */
  static async assertUserAvailableForLink(userId: string, excludeEmployeeId?: string) {
    const companyId = requireTenantId();
    const user = await prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!user) throw new AppError('User account not found', 404);

    const linked = await prisma.employee.findFirst({
      where: {
        companyId,
        userId,
        deletedAt: null,
        ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
      },
      select: { id: true, employeeNo: true, firstName: true, lastName: true },
    });
    if (linked) {
      throw new AppError(
        `That login is already linked to employee ${linked.employeeNo} (${linked.firstName} ${linked.lastName})`,
        409
      );
    }
    return user;
  }

  /** Link or unlink a system login to an HR employee (one user ↔ one employee). */
  static async linkEmployeeToUser(employeeId: string, userId: string | null) {
    const companyId = requireTenantId();
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
    });
    if (!employee) throw new AppError('Employee not found', 404);

    if (!userId) {
      return prisma.employee.update({
        where: { id: employeeId },
        data: { userId: null },
        include: {
          department: true,
          branch: true,
          user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
        },
      });
    }

    const user = await this.assertUserAvailableForLink(userId, employeeId);
    return prisma.employee.update({
      where: { id: employeeId },
      data: {
        userId: user.id,
        email: employee.email || user.email,
      },
      include: {
        department: true,
        branch: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
      },
    });
  }

  /** Resolve or create an Employee row for a logged-in user (self-service leave). */
  static async ensureEmployeeForUser(userId: string) {
    const companyId = requireTenantId();
    const user = await prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        departmentId: true,
        branchId: true,
        role: { select: { name: true } },
      },
    });
    if (!user) throw new AppError('User not found', 404);

    const byUser = await prisma.employee.findFirst({
      where: { companyId, userId: user.id, deletedAt: null },
    });
    if (byUser) return byUser;

    if (user.email) {
      const byEmail = await prisma.employee.findFirst({
        where: {
          companyId,
          deletedAt: null,
          email: user.email,
          OR: [{ userId: null }, { userId: user.id }],
        },
      });
      if (byEmail) {
        if (!byEmail.userId) {
          return prisma.employee.update({
            where: { id: byEmail.id },
            data: { userId: user.id },
          });
        }
        return byEmail;
      }
    }

    const count = await prisma.employee.count({ where: { companyId } });
    return prisma.employee.create({
      data: {
        companyId,
        userId: user.id,
        employeeNo: generateNumber('EMP', count + 1),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        departmentId: user.departmentId,
        branchId: user.branchId,
        position: user.role?.name || null,
        hireDate: new Date(),
        salary: 0,
        isActive: true,
      },
    });
  }

  static async notifyApproversOfRequest(input: {
    employeeName: string;
    type: string;
    startDate: Date;
    endDate: Date;
  }) {
    const title = `Leave request: ${input.employeeName}`;
    const message = `${input.employeeName} requested ${input.type} leave (${formatLeaveRange(input.startDate, input.endDate)}). Open HR to approve or reject.`;
    await NotificationService.notifyRole('HR', 'APPROVAL', title, message, '/hr');
    await NotificationService.notifyRole('Managing Director', 'APPROVAL', title, message, '/hr');
    await NotificationService.notifyAdmins('APPROVAL', title, message, '/hr');
  }

  static async notifyRequesterOfDecision(input: {
    requestedByUserId?: string | null;
    employeeEmail?: string | null;
    status: LeaveStatus;
    type: string;
    startDate: Date;
    endDate: Date;
    decisionNote?: string | null;
  }) {
    let userId = input.requestedByUserId || null;
    if (!userId && input.employeeEmail) {
      const companyId = requireTenantId();
      const match = await prisma.user.findFirst({
        where: {
          companyId,
          email: input.employeeEmail,
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      userId = match?.id || null;
    }
    if (!userId) return;

    const decided = input.status === 'APPROVED' ? 'approved' : input.status === 'REJECTED' ? 'rejected' : 'updated';
    const title = `Leave request ${decided}`;
    const note = input.decisionNote ? ` Note: ${input.decisionNote}` : '';
    const message = `Your ${input.type} leave (${formatLeaveRange(input.startDate, input.endDate)}) was ${decided}.${note}`;
    await NotificationService.notifyUser(userId, 'APPROVAL', title, message, '/my-leave');
  }
}
