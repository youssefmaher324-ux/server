import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class CreateIndividualBookingDto {
  @IsIn(['male', 'female'])
  gender: 'male' | 'female';

  @IsISO8601()
  arrivalDate: string;

  @IsISO8601()
  departureDate: string;

  @IsOptional()
  @IsString()
  churchName?: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  governorate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateRoomBookingDto {
  @IsInt()
  @Min(1)
  familySize: number;

  @IsISO8601()
  arrivalDate: string;

  @IsISO8601()
  departureDate: string;

  @IsOptional()
  @IsString()
  churchName?: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  governorate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateRetreatBookingDto {
  @IsString()
  churchName: string;

  @IsString()
  contactName: string;

  @IsString()
  phone: string;

  @IsInt()
  @Min(1)
  groupSize: number;

  @IsIn(['male', 'female'])
  gender: 'male' | 'female';

  @IsISO8601()
  arrivalDate: string;

  @IsISO8601()
  departureDate: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  governorate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectBookingDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ReassignRoomDto {
  @IsString()
  roomId: string;
}

export class SendBookingMessageDto {
  @IsString()
  message: string;
}
