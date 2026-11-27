/**
 * 도서관 안의 권한(personal 모드). 서버가 최종으로 막지만(library_scope), 화면에서도 쓸 수 없는 단추는 감춘다
 * — 눌렀다가 403을 보는 것보다 낫다. family 모드(가족 공용 서버)에서는 모두 편집할 수 있다(예전 그대로).
 */
export const ROLE_LABEL = {
  owner: "주인",
  manager: "공동 관리자",
  editor: "편집",
  viewer: "보기만",
};

export function canEdit(user, personal) {
  if (!personal) return true;
  return ["owner", "manager", "editor"].includes(user?.library_role);
}

export function canManageLibrary(user, personal) {
  return personal && ["owner", "manager"].includes(user?.library_role);
}
