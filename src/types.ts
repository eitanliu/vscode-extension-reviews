export interface ExtensionInfo {
  extensionId: string;
  extensionName: string;
  displayName: string;
  shortDescription: string;
  publisher: string;
  publisherId: string;
  version: string;
  installCount: number;
  averageRating: number;
  ratingCount: number;
  iconUrl?: string;
}

export interface Review {
  id: string;
  text: string;
  rating: number; // 1-5
  productVersion: string;
  createdDate: string;
  updatedDate: string;
  userId: string;
  userDisplayName: string;
  helpfulCount: number;
  unhelpfulCount: number;
}

export interface ReviewsResult {
  reviews: Review[];
  totalCount: number;
  hasMoreReviews: boolean;
}

export interface SearchResult {
  extensions: ExtensionInfo[];
  total: number;
}
