import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Length, Min, MinLength } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  identifier: string; // phone or email
}

export class VerifyOtpDto {
  @IsString()
  identifier: string;

  @IsString()
  @Length(6, 6)
  code: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class RegisterDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsString()
  @MinLength(8)
  password: string;

  // Monastery guest-house fields — optional so the juice-shop customer
  // registration flow (which never sends these) keeps working unchanged.
  @IsOptional()
  @IsString()
  churchName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  age?: number;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  code: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}
