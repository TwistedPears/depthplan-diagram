class Admin::PeopleController < ApplicationController
  def index
    @people = Admin::Person.order(:name)
  end
end
