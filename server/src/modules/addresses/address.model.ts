import mongoose, { Schema, type Document } from 'mongoose';

export interface IAddress extends Document {
  userId: mongoose.Types.ObjectId;
  label: string;
  recipientName: string;
  phone: string;
  division: string;
  divisionId?: string;
  divisionBn?: string;
  district: string;
  districtId?: string;
  districtBn?: string;
  upazila: string;
  upazilaId?: string;
  upazilaBn?: string;
  upazilaType?: 'upazila' | 'metropolitan_thana' | 'city_corporation';
  area: string;
  areaId?: string;
  areaBn?: string;
  areaType?: 'union' | 'ward' | 'pourashava';
  house: string;
  road?: string;
  landmark?: string;
  postalCode?: string;
  deliveryInstructions?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema<IAddress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, default: 'Home', trim: true, maxlength: 40 },
    recipientName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true, maxlength: 24 },
    division: { type: String, required: true, trim: true },
    divisionId: { type: String, trim: true },
    divisionBn: { type: String, trim: true },
    district: { type: String, required: true, trim: true },
    districtId: { type: String, trim: true },
    districtBn: { type: String, trim: true },
    upazila: { type: String, required: true, trim: true },
    upazilaId: { type: String, trim: true },
    upazilaBn: { type: String, trim: true },
    upazilaType: { type: String, enum: ['upazila', 'metropolitan_thana', 'city_corporation'] },
    area: { type: String, required: true, trim: true },
    areaId: { type: String, trim: true },
    areaBn: { type: String, trim: true },
    areaType: { type: String, enum: ['union', 'ward', 'pourashava'] },
    house: { type: String, required: true, trim: true, maxlength: 140 },
    road: { type: String, trim: true, maxlength: 140 },
    landmark: { type: String, trim: true, maxlength: 140 },
    postalCode: { type: String, trim: true, maxlength: 12 },
    deliveryInstructions: { type: String, trim: true, maxlength: 240 },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const AddressModel = mongoose.models.Address || mongoose.model<IAddress>('Address', AddressSchema);
