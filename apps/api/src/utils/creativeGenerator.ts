export interface CreativeData {
  agencyLogo?: string | null; 
  agencyName: string;
  packages: Array<{
    title: string;
    description?: string | null;
    difficulty: string;
    durationDays: number;
    pricePerPerson: number;
    photos: string[];
  }>;
}

export interface AdCreative {
  title: string;
  imageUrls: string[];
  copyText: string;
  variant: number;
}

export function generateCreativeVariations(data: CreativeData): AdCreative[] {
  const variations: AdCreative[] = [];

  // Variation 1: Adventure-focused
  variations.push({
    variant: 1,
    title: `Epic ${data.packages[0]?.difficulty || 'Adventure'} Trek with ${data.agencyName}`,
    imageUrls: data.packages[0]?.photos.slice(0, 2) || [],
    copyText: generateAdCopy(data, 'adventure'),
  });

  // Variation 2: Value-focused
  variations.push({
    variant: 2,
    title: `Unforgettable ${data.packages[0]?.durationDays}-Day Trek — Starting at ${formatPrice(
      data.packages[0]?.pricePerPerson || 0
    )}`,
    imageUrls: data.packages[1]?.photos.slice(0, 2) || [],
    copyText: generateAdCopy(data, 'value'),
  });

  // Variation 3: Experience-focused
  variations.push({
    variant: 3,
    title: `Discover Hidden Trails with Local Experts`,
    imageUrls: [
      data.packages[0]?.photos[0],
      data.packages[1]?.photos[0],
      data.packages[2]?.photos[0],
    ].filter(Boolean) as string[],
    copyText: generateAdCopy(data, 'experience'),
  });

  return variations;
}

function generateAdCopy(
  data: CreativeData,
  tone: 'adventure' | 'value' | 'experience'
): string {
  const { packages, agencyName } = data;
  const mainPackage = packages[0];

  switch (tone) {
    case 'adventure':
      return `Experience the thrill of a ${mainPackage?.difficulty} trek with ${agencyName}. 
${mainPackage?.durationDays} days of breathtaking views, expert guides, and unforgettable memories. 
${mainPackage?.description || 'Perfect for adventure seekers.'} 
Book your next adventure today!`;

    case 'value':
      return `Limited-time offer: ${mainPackage?.durationDays}-day trek starting at just $${mainPackage?.pricePerPerson}. 
All-inclusive package with ${agencyName}'s expert guides. 
Only ${mainPackage?.difficulty} difficulty — suitable for most trekkers. 
Don't miss out. Book now!`;

    case 'experience':
      return `Trek through ${packages.map((p) => p.title).join(', ')}. 
Walk with local experts who know every trail, every story, every hidden gem. 
From ${mainPackage?.difficulty} to challenging peaks, ${agencyName} has the perfect trek for you. 
Your adventure starts here. Explore now!`;

    default:
      return 'Book your next trek with us!';
  }
}

function formatPrice(price: number): string {
  return `$${Math.round(price)}`;
}