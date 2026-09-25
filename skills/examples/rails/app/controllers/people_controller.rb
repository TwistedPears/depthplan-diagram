class PeopleController < ApplicationController
  def index
    @people = Person.order(:email)
  end

  def update
    Person.find(params[:id]).update!(params.require(:person).permit(:email))
    redirect_to people_path
  end
end
